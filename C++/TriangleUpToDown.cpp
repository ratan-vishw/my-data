#include<iostream>
using namespace std;
int main() {
  cout<<"Enter number: ";
  int n;
  cin>>n;
  for (int i = 2; n>=i; i++){
    for (int j = i-1; j>=0; j--){
      cout<<j<<" ";
    }
    cout<<endl;
  }
  return 0;
}