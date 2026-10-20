#include<iostream>
using namespace std;
int main(){
  int arry[] = {98, 23, 43, 5, 93, 245};
  int size = sizeof(arry) / sizeof(arry[1]);
  for (int i = 0; i<size; i++){
    cout<<arry[i]<<endl;
  }
  return 0;
}