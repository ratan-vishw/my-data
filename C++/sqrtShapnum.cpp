#include<iostream>
using namespace std;
int main(){

  cout<<"Enter Number: ";
  int n;
  cin>>n;
  int num = 1;
  for(int i = 0; n>=i; i++){
    for(int j = 0; n>=j; j++){
      cout<<num<<" ";
      num++;
    }
    cout<<endl;
  }
  
  return 0;
}