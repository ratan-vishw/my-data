#include<iostream>
using namespace std;
int main(){
  cout<<"Enter Number: ";
  int n;
  cin>>n;
  int width = n*2-1;
  for (int i = 0; i<n; i++){
    for (int j = 0; j < width; j++){
      if (j == n - i -1 || j == n + i -1 ){
        cout<<"*";
      }else {
        cout<<" ";
      }
    }
    cout<<endl;
  }

  // bottom 
  for (int i = n-2; i>=0; i--){
    for (int j = 0; j < width; j++){
      if (j == n - i -1 || j == n + i -1 ){
        cout<<"*";
      }else {
        cout<<" ";
      }
    }
    cout<<endl;
  }
  return 0;
}